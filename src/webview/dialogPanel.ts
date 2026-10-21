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
import type { IBusyMessage } from "./dialogProtocol.js";
import { webviewOptions } from "./html.js";

/** What `DialogPanel.runBusy` does with a failure. */
export interface IDialogFailure<H> {
    /** The dialog's own message for it, shown while the dialog is open. */
    message(text: string): H;
    /** What the log says of it, if anything. */
    log?(text: string): void;
    /** What a notification says, once the dialog was closed: the text. */
    notify?(text: string): string;
    /** Called once the failure was shown, in the dialog or not. */
    onFailed?(): void;
}

/**
 * Asks for a folder with VS Code's own picker.
 *
 * @param title What the picker is for.
 * @param current Where it starts, if anywhere.
 *
 * @returns The folder picked, or undefined.
 */
export const pickFolder = async (
    title: string,
    current = "",
): Promise<string | undefined> => {
    const picked = await vscode.window.showOpenDialog({
        title,
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Select Folder",
        ...(current.trim() === ""
            ? {} : { defaultUri: vscode.Uri.file(current) }),
    });

    return picked?.[0]?.fsPath;
};

/**
 * What every dialog of the extension is made of: its webview panel, the
 * messages to and from it, and the work its main button does - the
 * progress bar while it runs, the dialog closing once it is done, and a
 * failure shown in the dialog, or as a notification where the dialog was
 * closed meanwhile. How many may be open at a time, and what asking for an
 * open one again does, is each dialog's own.
 *
 * @typeParam H The messages the dialog is sent.
 * @typeParam W The messages it sends.
 */
export abstract class DialogPanel<H extends { type: string }, W> {
    protected readonly panel: vscode.WebviewPanel;
    #disposed = false;
    #disposables: vscode.Disposable[] = [];

    /**
     * Opens the panel. Its HTML is the subclass's to load, once it is set
     * up: the webview asks for its state as soon as it runs.
     *
     * @param viewType The panel's view type.
     * @param title Its tab title.
     * @param extensionUri The extension's folder.
     */
    protected constructor(
        viewType: string,
        title: string,
        extensionUri: vscode.Uri,
    ) {
        this.panel = vscode.window.createWebviewPanel(viewType, title,
            vscode.ViewColumn.Active,
            { ...webviewOptions(extensionUri), retainContextWhenHidden: true });
        this.panel.onDidDispose(() => { this.dispose(); }, undefined,
            this.#disposables);
        this.panel.webview.onDidReceiveMessage((message: W) => {
            void this.onMessage(message);
        }, undefined, this.#disposables);
    }

    /** One message from the webview. */
    protected abstract onMessage(message: W): Promise<void>;

    /** Called once the panel is gone, to forget it. */
    protected abstract onDisposed(): void;

    /**
     * @returns Whether the panel has been closed.
     */
    protected get disposed(): boolean {
        return this.#disposed;
    }

    /**
     * Sends a message to the webview, unless it has been closed - which
     * work that outlives its dialog finds it has.
     *
     * @param message The message.
     */
    protected post(message: H): void {
        if (!this.#disposed) {
            void this.panel.webview.postMessage(message);
        }
    }

    /**
     * Does the dialog's work with its progress bar showing, and closes it
     * once done.
     *
     * @param work The work. It resolves to false where it found a reason
     *             to stop and said so in the dialog, which then stays open.
     * @param failure What to do with a failure.
     */
    protected async runBusy(
        work: () => Promise<boolean | void>,
        failure: IDialogFailure<H>,
    ): Promise<void> {
        this.#postBusy(true);
        try {
            if (await work() !== false) {
                this.panel.dispose();
            }
        } catch (error) {
            const text = errorText(error);
            failure.log?.(text);
            if (this.#disposed) {
                // Closed while it ran: nowhere left to say it but a
                // notification.
                void showErrorWithLog(failure.notify?.(text) ?? text);
            } else {
                this.post(failure.message(text));
            }
            failure.onFailed?.();
        } finally {
            this.#postBusy(false);
        }
    }

    /**
     * @param busy Whether the dialog's buttons are to show it as busy.
     */
    #postBusy(busy: boolean): void {
        const message: IBusyMessage = { type: "busy", busy };
        this.post(message as unknown as H);
    }

    /** Closes the panel. */
    public close(): void {
        this.panel.dispose();
    }

    /** Tears the panel down: VS Code calls it once the panel is closed. */
    public dispose(): void {
        this.#disposed = true;
        this.onDisposed();
        for (const disposable of this.#disposables) {
            disposable.dispose();
        }
        this.#disposables = [];
    }
}
