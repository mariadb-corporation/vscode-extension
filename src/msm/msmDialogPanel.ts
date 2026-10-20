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

import { showErrorWithLog } from "../errorMessages.js";
import { errorText } from "../text.js";
import { buildWebviewHtml, webviewOptions } from "../webview/html.js";
import {
    msmProblem,
    type IMsmConnectionChoice,
    type IMsmProblem,
    type IMsmProjectContext,
    type MsmDialogKind,
    type MsmValues,
} from "./msmFields.js";
import type {
    IMsmOpenMessage,
    MsmHostMessage,
    MsmWebviewMessage,
} from "./msmProtocol.js";

/** What a dialog is opened with. */
export interface IMsmDialogSpec {
    kind: MsmDialogKind;
    title: string;
    project?: IMsmProjectContext;
    values: MsmValues;
    licenses?: readonly string[];
    connections?: IMsmConnectionChoice[];
}

/** What the dialog asks of the extension. */
export interface IMsmDialogHost {
    /**
     * Does what the dialog is for. Resolves once done, after which the
     * dialog closes; a rejection is shown in the dialog.
     */
    submit(values: MsmValues): Promise<void>;
    /**
     * Checks what only the extension can tell - whether a folder exists -
     * before anything is done, so the dialog stays open and says why.
     */
    check?(values: MsmValues): Promise<IMsmProblem | undefined>;
    /** One of the project information's buttons. */
    open?(what: IMsmOpenMessage["what"]): Promise<void>;
    /**
     * Called after the work failed, once that has been shown: in the
     * dialog, or as a notification where the dialog was closed.
     */
    onFailed?(): void;
    log(message: string): void;
}

export const MSM_DIALOG_VIEW_TYPE = "mariadb.msmDialog";

/**
 * The MariaDB Schema Management dialogs: New MSM Project, the project's
 * information, Prepare Release, Generate Deployment Script and Deploy
 * Schema. One at a time, as the other dialogs are; it closes once the work
 * is done, and the Actions tab has what it did.
 */
export class MsmDialogPanel {
    static #current: MsmDialogPanel | undefined;

    #panel: vscode.WebviewPanel;
    #disposed = false;
    #disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly spec: IMsmDialogSpec,
        private readonly host: IMsmDialogHost,
    ) {
        this.#panel = panel;
    }

    /**
     * Opens the dialog, replacing one that is open.
     *
     * @param extensionUri The extension's folder.
     * @param spec What the dialog shows.
     * @param host What it does.
     */
    public static show(
        extensionUri: vscode.Uri,
        spec: IMsmDialogSpec,
        host: IMsmDialogHost,
    ): void {
        MsmDialogPanel.disposeCurrent();

        const panel = vscode.window.createWebviewPanel(
            MSM_DIALOG_VIEW_TYPE,
            spec.title,
            vscode.ViewColumn.Active,
            { ...webviewOptions(extensionUri), retainContextWhenHidden: true },
        );
        const dialog = new MsmDialogPanel(panel, spec, host);
        MsmDialogPanel.#current = dialog;

        panel.onDidDispose(() => { dialog.dispose(); }, undefined,
            dialog.#disposables);
        panel.webview.onDidReceiveMessage(
            (message: MsmWebviewMessage) => {
                void dialog.#onMessage(message);
            },
            undefined,
            dialog.#disposables,
        );
        panel.webview.html = buildWebviewHtml(panel.webview, extensionUri,
            "msm", spec.title);
    }

    public static disposeCurrent(): void {
        const open = MsmDialogPanel.#current;
        if (open !== undefined) {
            open.#panel.dispose();
        }
    }

    #post(message: MsmHostMessage): void {
        if (!this.#disposed) {
            void this.#panel.webview.postMessage(message);
        }
    }

    async #onMessage(message: MsmWebviewMessage): Promise<void> {
        switch (message.type) {
            case "ready": {
                this.#post({
                    type: "load",
                    kind: this.spec.kind,
                    title: this.spec.title,
                    values: this.spec.values,
                    ...(this.spec.project === undefined
                        ? {} : { project: this.spec.project }),
                    ...(this.spec.licenses === undefined
                        ? {} : { licenses: this.spec.licenses }),
                    ...(this.spec.connections === undefined
                        ? {} : { connections: this.spec.connections }),
                });
                break;
            }

            case "browse": {
                const picked = await vscode.window.showOpenDialog({
                    title: this.spec.title,
                    canSelectFolders: true,
                    canSelectFiles: false,
                    canSelectMany: false,
                    openLabel: "Select Folder",
                    ...(message.current.trim() === "" ? {}
                        : { defaultUri: vscode.Uri.file(message.current) }),
                });
                const path = picked?.[0]?.fsPath;
                if (path !== undefined) {
                    this.#post({ type: "browsed", field: message.field, path });
                }
                break;
            }

            case "open": {
                try {
                    await this.host.open?.(message.what);
                } catch (error) {
                    this.#post({ type: "error", message: errorText(error) });
                }
                break;
            }

            case "submit": {
                await this.#submit(message.values);
                break;
            }

            default: {
                this.#panel.dispose();
            }
        }
    }

    /**
     * Checks the values again, as this is what does the work, and does it.
     *
     * @param values What the dialog says.
     */
    async #submit(values: MsmValues): Promise<void> {
        const problem = msmProblem(this.spec.kind, this.spec.project, values);
        if (problem !== undefined) {
            this.#post({ type: "error", ...problem });

            return;
        }

        this.#post({ type: "busy", busy: true });
        try {
            const found = await this.host.check?.(values);
            if (found !== undefined) {
                this.#post({ type: "error", ...found });

                return;
            }
            await this.host.submit(values);
            this.#panel.dispose();
        } catch (error) {
            const text = errorText(error);
            this.host.log(`${this.spec.title} failed: ${text}`);
            if (this.#disposed) {
                // Closed while it ran: nowhere left to say it but a
                // notification.
                void showErrorWithLog(`${this.spec.title} failed: ${text}`);
            } else {
                this.#post({ type: "error", message: text });
            }
            this.host.onFailed?.();
        } finally {
            this.#post({ type: "busy", busy: false });
        }
    }

    public dispose(): void {
        this.#disposed = true;
        if (MsmDialogPanel.#current === this) {
            MsmDialogPanel.#current = undefined;
        }
        for (const disposable of this.#disposables) {
            disposable.dispose();
        }
        this.#disposables = [];
    }
}
