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
import { DialogPanel } from "../webview/dialogPanel.js";
import { buildWebviewHtml } from "../webview/html.js";
import { validateDialog, type MrsDialogKind } from "./mrsDialogs.js";
import type {
    MrsHostMessage,
    MrsWebviewMessage,
} from "./mrsDialogProtocol.js";
import type { IMrsColumns, IMrsScriptDefinitions } from "./mrsTypes.js";

/**
 * The webview panel behind every MRS dialog.
 *
 * Which dialog it is, what it starts with and what saving it does come in
 * an {@link IMrsDialogSpec}, which the commands build; this owns the panel,
 * the HTML and the message loop, as `SandboxEditorPanel` does for New
 * Sandbox.
 */

/** One dialog: what it shows, and what its buttons do. */
export interface IMrsDialogSpec {
    dialog: MrsDialogKind;
    title: string;
    values: unknown;
    context: unknown;
    /**
     * Saves the fields, which have passed validation. What it did is a row
     * of the connection's Actions, so it reports nothing itself.
     */
    save(values: unknown): Promise<void>;
    /** The columns of a table a data mapping reference points to. */
    loadColumns?(schema: string, table: string): Promise<IMrsColumns>;
    /** What a folder's MRS scripts define. */
    analyzeFolder?(directory: string, ignoreList: string): Promise<{
        language?: string;
        definitions?: IMrsScriptDefinitions;
    }>;
}

/** What the panel needs from the extension, so a test can supply its own. */
export interface IMrsDialogHost {
    /** Called after a save went through. */
    onSaved(): void;
    /** Called after a save failed, once the error has been shown. */
    onFailed(): void;
    log(message: string): void;
}

/** The view type the panel is registered under. */
export const MRS_DIALOG_VIEW_TYPE = "mariadb.mrsDialog";

/**
 * Builds the HTML the dialogs load: the shared shell with their bundle.
 *
 * @param webview The webview to build it for.
 * @param extensionUri The root of the installed extension.
 * @param title The document title.
 *
 * @returns The HTML document.
 */
export const buildMrsDialogHtml = (
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    title: string,
): string => {
    return buildWebviewHtml(webview, extensionUri, "mrs", title);
};

/**
 * Opens MRS dialogs, one per kind: asking for one that is up replaces
 * what it shows, as the connection editor does.
 */
export class MrsDialogPanel
    extends DialogPanel<MrsHostMessage, MrsWebviewMessage> {
    static readonly #current = new Map<MrsDialogKind, MrsDialogPanel>();

    #spec: IMrsDialogSpec;
    #host: IMrsDialogHost;

    private constructor(
        extensionUri: vscode.Uri,
        spec: IMrsDialogSpec,
        host: IMrsDialogHost,
    ) {
        super(MRS_DIALOG_VIEW_TYPE, spec.title, extensionUri);
        this.#spec = spec;
        this.#host = host;
        this.panel.webview.html = buildMrsDialogHtml(this.panel.webview,
            extensionUri, spec.title);
    }

    /**
     * Shows a dialog.
     *
     * @param extensionUri The root of the installed extension.
     * @param spec The dialog.
     * @param host What the panel needs from the extension.
     *
     * @returns Nothing.
     */
    public static show(
        extensionUri: vscode.Uri,
        spec: IMrsDialogSpec,
        host: IMrsDialogHost,
    ): void {
        const open = MrsDialogPanel.#current.get(spec.dialog);
        if (open !== undefined) {
            // What it shows and who hears of its save are the new caller's.
            open.#spec = spec;
            open.#host = host;
            open.panel.title = spec.title;
            open.panel.webview.html = buildMrsDialogHtml(
                open.panel.webview, extensionUri, spec.title);
            open.panel.reveal(vscode.ViewColumn.Active);

            return;
        }

        MrsDialogPanel.#current.set(spec.dialog,
            new MrsDialogPanel(extensionUri, spec, host));
    }

    /**
     * Closes every MRS dialog. Used when the extension shuts down.
     *
     * @returns Nothing.
     */
    public static disposeAll(): void {
        for (const dialog of [...MrsDialogPanel.#current.values()]) {
            dialog.close();
        }
    }

    protected onDisposed(): void {
        MrsDialogPanel.#current.delete(this.#spec.dialog);
    }

    protected async onMessage(message: MrsWebviewMessage): Promise<void> {
        switch (message.type) {
            case "ready": {
                this.post({
                    type: "load",
                    dialog: this.#spec.dialog,
                    title: this.#spec.title,
                    values: this.#spec.values,
                    context: this.#spec.context,
                });
                break;
            }

            case "save": {
                await this.#save(message.values);
                break;
            }

            case "browse": {
                const picked = await vscode.window.showOpenDialog({
                    canSelectFolders: message.folders,
                    canSelectFiles: !message.folders,
                    canSelectMany: false,
                });
                if (picked?.[0] !== undefined) {
                    this.post({
                        type: "browsed",
                        field: message.field,
                        path: picked[0].fsPath,
                    });
                }
                break;
            }

            case "loadColumns": {
                await this.#loadColumns(message.requestId, message.schema,
                    message.table);
                break;
            }

            case "analyzeFolder": {
                await this.#analyzeFolder(message.directory,
                    message.ignoreList);
                break;
            }

            case "copy": {
                await vscode.env.clipboard.writeText(message.text);
                void vscode.window.showInformationMessage(
                    "The REST SQL was copied to the clipboard.");
                break;
            }

            default: {
                this.close();
            }
        }
    }

    async #save(values: unknown): Promise<void> {
        // Checked again here, not only in the dialog: this is what is
        // about to change the server.
        const problems = validateDialog(this.#spec.dialog, values,
            this.#spec.context);
        if (problems.length > 0) {
            this.post({ type: "saveError", message: problems[0].message });

            return;
        }

        await this.runBusy(async () => {
            await this.#spec.save(values);
            this.#host.onSaved();
        }, {
            message: (text) => { return { type: "saveError", message: text }; },
            log: (text) => {
                this.#host.log(`Failed to save the ${this.#spec.title}: ${text}`);
            },
            onFailed: () => { this.#host.onFailed(); },
        });
    }

    async #loadColumns(
        requestId: number,
        schema: string,
        table: string,
    ): Promise<void> {
        if (this.#spec.loadColumns === undefined) {
            this.post({ type: "columns", requestId, error: "Not available." });

            return;
        }
        try {
            this.post({
                type: "columns",
                requestId,
                columns: await this.#spec.loadColumns(schema, table),
            });
        } catch (error) {
            this.post({ type: "columns", requestId, error: errorText(error) });
        }
    }

    async #analyzeFolder(directory: string, ignoreList: string): Promise<void> {
        if (this.#spec.analyzeFolder === undefined || directory === "") {
            return;
        }
        try {
            this.post({
                type: "scripts",
                directory,
                ...await this.#spec.analyzeFolder(directory, ignoreList),
            });
        } catch (error) {
            this.post({ type: "scripts", directory, error: errorText(error) });
        }
    }
}
