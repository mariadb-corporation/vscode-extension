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

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IRestdApi } from "../../mcp/restdApi.js";
import { MrsDialogPanel, type IMrsDialogSpec } from "../../mrs/mrsDialogPanel.js";
import type { IRestdDialogValues } from "../../mrs/mrsDialogs.js";
import { RestdCommands } from "../../restd/restdCommands.js";
import type { IConnectionNode } from "../../tree/connectionsModel.js";
import type { RestdTreeProvider } from "../../tree/restdTreeProvider.js";
import type { IActionRow } from "../../webview/protocol.js";
import { resetVscodeMock, Uri } from "../mocks/vscode.js";

let shown: IMrsDialogSpec[] = [];

beforeEach(() => {
    MrsDialogPanel.disposeAll();
    resetVscodeMock();
    shown = [];
    vi.spyOn(MrsDialogPanel, "show").mockImplementation((_uri, spec) => {
        shown.push(spec);
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

const URI = "root@127.0.0.1:3311";

describe("Set Up MariaDB REST Daemon", () => {
    it("is set up when the system dialog trusting the certificate is "
        + "cancelled", async () => {
        const rows: IActionRow[] = [];
        const actions: string[] = [];
        const restdApi = {
            certificateStatus: () => {
                return Promise.resolve({ exists: true, trusted: false,
                    ca_path: "/c" });
            },
            configure: () => {
                return Promise.resolve({ url: "https://localhost:8443",
                    installed: false, directory: "/d" });
            },
            trustCertificate: () => {
                return Promise.reject(new Error("The dialog was cancelled."));
            },
        } as unknown as IRestdApi;
        const commands = new RestdCommands({
            extensionUri: Uri.file("/ext") as never,
            connect: () => { return Promise.resolve("c1"); },
            metadataSchemas: () => { return Promise.resolve([]); },
            restdApi: () => { return Promise.resolve(restdApi); },
            tree: {} as RestdTreeProvider,
            put: (_connection, row) => { rows.push(row); },
            showActions: (connection) => { actions.push(connection); },
            logFolder: "/logs",
            log: () => { /* not logged */ },
        });

        await commands.setUp({ kind: "connection", uri: URI } as IConnectionNode);
        const [spec] = shown;

        // The dialog is done: the daemon is running.
        await expect(spec!.save({
            ...spec!.values as IRestdDialogValues,
            trustCertificate: true,
        })).resolves.toBeUndefined();
        expect(actions).toEqual([URI]);
        expect(rows.at(-1)?.children?.at(-1)).toMatchObject({
            kind: "error",
            message: "Registering the HTTPS Certificate failed: "
                + "The dialog was cancelled.",
        });
    });

    it("keeps the mariadb-restd install's log for the setup's row",
        async () => {
            const logFolder = await mkdtemp(join(tmpdir(), "restd-logs-"));
            const rows: IActionRow[] = [];
            const restdApi = {
                certificateStatus: () => {
                    return Promise.resolve({ exists: true, trusted: true,
                        ca_path: "/c" });
                },
                configure: () => {
                    return Promise.resolve({ url: "https://localhost:8443",
                        installed: true, directory: "/d",
                        install_output: "Installing mariadb-restd 26.11.0" });
                },
            } as unknown as IRestdApi;
            const commands = new RestdCommands({
                extensionUri: Uri.file("/ext") as never,
                connect: () => { return Promise.resolve("c1"); },
                metadataSchemas: () => { return Promise.resolve([]); },
                restdApi: () => { return Promise.resolve(restdApi); },
                tree: {} as RestdTreeProvider,
                put: (_connection, row) => { rows.push(row); },
                showActions: () => { /* not shown */ },
                logFolder,
                log: () => { /* not logged */ },
            });

            const node = { kind: "connection", uri: URI } as IConnectionNode;
            try {
                await commands.setUp(node);
                const [spec] = shown;
                await spec!.save({
                    ...spec!.values as IRestdDialogValues,
                    trustCertificate: false,
                });

                const setup = rows.at(-1)?.children?.at(-1);
                expect(setup).toMatchObject({ kind: "info" });
                expect(setup?.logPath).toMatch(/restd-install-.*\.log$/u);
                expect(await readFile(setup!.logPath!, "utf8"))
                    .toBe("Installing mariadb-restd 26.11.0\n");
            } finally {
                await rm(logFolder, { recursive: true, force: true });
            }
        });
});
