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

import * as vscode from "vscode";

import { connectionLabel } from "../connections/connectionUri.js";
import { DialogPanel, pickFolder } from "../webview/dialogPanel.js";
import { buildWebviewHtml } from "../webview/html.js";
import type { UtilOptions } from "../mcp/utilApi.js";
import {
    buildUtilOptions,
    initialUtilValues,
    type IUtilOperationSpec,
    type IUtilProblem,
} from "./utilFields.js";
import type { UtilHostMessage, UtilWebviewMessage } from "./utilProtocol.js";

/** What the dialog asks of the extension. */
export interface IUtilDialogHost {
    /** The path the dialog starts with. */
    initialPath?: string;
    /** The connections a copy can go to. */
    targets?: string[];
    /**
     * Starts the work. Resolves once it runs, after which the dialog
     * closes; a rejection is shown in the dialog.
     */
    start(options: UtilOptions, paths: string[], target?: string):
        Promise<void>;
    /**
     * Checks the paths before anything starts, where the extension can
     * tell what the shell would refuse - a dump folder that is not empty -
     * so the dialog stays open and says why.
     */
    check?(paths: string[]): Promise<IUtilProblem | undefined>;
    /**
     * Called after the work failed to start, once that has been shown: in
     * the dialog, or as a notification where the dialog was closed.
     */
    onFailed?(): void;
    log(message: string): void;
}

export const UTIL_DIALOG_VIEW_TYPE = "mariadb.utilDialog";

/**
 * The dialog that sets up a dump, load, copy, export or import: one at a
 * time, as the other dialogs are. It closes once the work started; its
 * progress is shown by the task's notification and the Tasks view.
 */
export class UtilDialogPanel
    extends DialogPanel<UtilHostMessage, UtilWebviewMessage> {
    static #current: UtilDialogPanel | undefined;

    private constructor(
        extensionUri: vscode.Uri,
        private readonly spec: IUtilOperationSpec,
        private readonly host: IUtilDialogHost,
    ) {
        super(UTIL_DIALOG_VIEW_TYPE, spec.title, extensionUri);
        this.panel.webview.html = buildWebviewHtml(this.panel.webview,
            extensionUri, "util", spec.title);
    }

    /**
     * Opens the dialog, replacing one that is open for something else.
     *
     * @param extensionUri The extension's folder.
     * @param spec What the dialog asks for.
     * @param host What it starts.
     */
    public static show(
        extensionUri: vscode.Uri,
        spec: IUtilOperationSpec,
        host: IUtilDialogHost,
    ): void {
        UtilDialogPanel.disposeCurrent();
        UtilDialogPanel.#current = new UtilDialogPanel(extensionUri, spec, host);
    }

    public static disposeCurrent(): void {
        UtilDialogPanel.#current?.close();
    }

    protected onDisposed(): void {
        if (UtilDialogPanel.#current === this) {
            UtilDialogPanel.#current = undefined;
        }
    }

    protected async onMessage(message: UtilWebviewMessage): Promise<void> {
        switch (message.type) {
            case "ready": {
                this.post({
                    type: "load",
                    spec: this.spec,
                    values: initialUtilValues(this.spec,
                        this.host.initialPath ?? ""),
                    targets: (this.host.targets ?? []).map((uri) => {
                        return { uri, label: connectionLabel(uri) };
                    }),
                });
                break;
            }

            case "browse": {
                const path = await this.#browse(message.current);
                if (path !== undefined) {
                    this.post({ type: "browsed", path });
                }
                break;
            }

            case "start": {
                // Checked again here: this is what starts the work.
                const built = buildUtilOptions(this.spec, message.values);
                if ("problem" in built) {
                    this.post({
                        type: "startError", message: built.problem.message,
                        field: built.problem.field,
                    });
                    break;
                }

                const failed = (text: string): string => {
                    return `${this.spec.title} did not start: ${text}`;
                };
                await this.runBusy(async () => {
                    const problem = await this.host.check?.(built.paths);
                    if (problem !== undefined) {
                        this.post({ type: "startError", ...problem });

                        return false;
                    }
                    await this.host.start(built.options, built.paths,
                        built.target);

                    return true;
                }, {
                    message: (text) => {
                        return { type: "startError", message: text };
                    },
                    log: (text) => { this.host.log(failed(text)); },
                    notify: failed,
                    onFailed: () => { this.host.onFailed?.(); },
                });
                break;
            }

            default: {
                this.close();
            }
        }
    }

    /**
     * @param current What the path field holds, to start the picker at.
     *
     * @returns The path picked, or undefined where none was.
     */
    async #browse(current: string): Promise<string | undefined> {
        const browse = this.spec.path?.browse;
        const first = current.split(",")[0].trim();
        const title = this.spec.path?.label;

        if (browse === "folder") {
            return pickFolder(title ?? this.spec.title, first);
        }

        const start = first === "" ? undefined : vscode.Uri.file(first);
        if (browse === "saveFile") {
            const picked = await vscode.window.showSaveDialog({
                title,
                ...(start === undefined ? {} : { defaultUri: start }),
            });

            return picked?.fsPath;
        }

        const picked = await vscode.window.showOpenDialog({
            title,
            canSelectFolders: false,
            canSelectFiles: browse === "openFiles",
            canSelectMany: browse === "openFiles",
            openLabel: "Select",
            ...(start === undefined ? {} : { defaultUri: start }),
        });
        if (picked === undefined || picked.length === 0) {
            return undefined;
        }

        return picked.map((uri) => { return uri.fsPath; }).join(", ");
    }
}
