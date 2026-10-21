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

import { errorText } from "../text.js";
import { DialogPanel, pickFolder } from "../webview/dialogPanel.js";
import { buildWebviewHtml } from "../webview/html.js";
import {
    msmProblem,
    type IMsmProblem,
    type IMsmValuesOf,
    type MsmDialogKind,
    type MsmValues,
} from "./msmFields.js";
import type {
    IMsmLoadMessage,
    IMsmOpenMessage,
    MsmHostMessage,
    MsmWebviewMessage,
} from "./msmProtocol.js";

/** What a dialog is opened with: what its load message says. */
export interface IMsmDialogSpec<K extends MsmDialogKind = MsmDialogKind>
    extends Omit<IMsmLoadMessage, "type" | "kind" | "values"> {
    kind: K;
    values: IMsmValuesOf[K];
}

/** What the dialog asks of the extension. */
export interface IMsmDialogHost<K extends MsmDialogKind = MsmDialogKind> {
    /**
     * Does what the dialog is for. Resolves once done, after which the
     * dialog closes; a rejection is shown in the dialog. The project
     * information has nothing to do.
     */
    submit?(values: IMsmValuesOf[K]): Promise<void>;
    /**
     * Checks what only the extension can tell - whether a folder exists -
     * before anything is done, so the dialog stays open and says why.
     */
    check?(values: IMsmValuesOf[K]): Promise<IMsmProblem | undefined>;
    /** One of the project information's buttons. */
    open?(what: IMsmOpenMessage["what"]): Promise<void>;
    /**
     * Called after the work failed, once that has been shown: in the
     * dialog, or as a notification where the dialog was closed.
     */
    onFailed?(values: IMsmValuesOf[K]): void;
    log(message: string): void;
}

export const MSM_DIALOG_VIEW_TYPE = "mariadb.msmDialog";

/**
 * The MariaDB Schema Management dialogs: New MSM Project, the project's
 * information, Prepare Release, Generate Deployment Script and Deploy
 * Schema. One at a time, as the other dialogs are; it closes once the work
 * is done, and the Actions tab has what it did.
 */
export class MsmDialogPanel
    extends DialogPanel<MsmHostMessage, MsmWebviewMessage> {
    static #current: MsmDialogPanel | undefined;

    private constructor(
        extensionUri: vscode.Uri,
        private readonly spec: IMsmDialogSpec,
        private readonly host: IMsmDialogHost<MsmDialogKind>,
    ) {
        super(MSM_DIALOG_VIEW_TYPE, spec.title, extensionUri);
        this.panel.webview.html = buildWebviewHtml(this.panel.webview,
            extensionUri, "msm", spec.title);
    }

    /**
     * Opens the dialog, replacing one that is open.
     *
     * @param extensionUri The extension's folder.
     * @param spec What the dialog shows.
     * @param host What it does.
     */
    public static show<K extends MsmDialogKind>(
        extensionUri: vscode.Uri,
        spec: IMsmDialogSpec<K>,
        host: IMsmDialogHost<K>,
    ): void {
        MsmDialogPanel.disposeCurrent();
        // One kind per dialog: the values it gets back are of that kind.
        MsmDialogPanel.#current = new MsmDialogPanel(extensionUri, spec,
            host as IMsmDialogHost<MsmDialogKind>);
    }

    public static disposeCurrent(): void {
        MsmDialogPanel.#current?.close();
    }

    protected onDisposed(): void {
        if (MsmDialogPanel.#current === this) {
            MsmDialogPanel.#current = undefined;
        }
    }

    protected async onMessage(message: MsmWebviewMessage): Promise<void> {
        switch (message.type) {
            case "ready": {
                this.post({ type: "load", ...this.spec });
                break;
            }

            case "browse": {
                const path = await pickFolder(this.spec.title, message.current);
                if (path !== undefined) {
                    this.post({ type: "browsed", field: message.field, path });
                }
                break;
            }

            case "open": {
                try {
                    await this.host.open?.(message.what);
                } catch (error) {
                    this.post({ type: "error", message: errorText(error) });
                }
                break;
            }

            case "submit": {
                await this.#submit(message.values);
                break;
            }

            default: {
                this.close();
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
            this.post({ type: "error", ...problem });

            return;
        }

        const failed = (text: string): string => {
            return `${this.spec.title} failed: ${text}`;
        };
        await this.runBusy(async () => {
            const found = await this.host.check?.(values);
            if (found !== undefined) {
                this.post({ type: "error", ...found });

                return false;
            }
            await this.host.submit?.(values);

            return true;
        }, {
            message: (text) => { return { type: "error", message: text }; },
            log: (text) => { this.host.log(failed(text)); },
            notify: failed,
            onFailed: () => { this.host.onFailed?.(values); },
        });
    }
}
