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
import type { DumpInspection } from "./dumpInspection.js";
import { withZipSuffix, ZIP_SUFFIX } from "./dumpSelection.js";
import {
    buildUtilOptions,
    initialUtilValues,
    type IUtilOperationSpec,
    type IUtilProblem,
} from "./utilFields.js";
import type {
    IUtilInspectedMessage,
    UtilHostMessage,
    UtilWebviewMessage,
} from "./utilProtocol.js";

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
     * A load's dump, which the dialog reads and lists on its Objects tab,
     * and which turns what is unticked there into the load's options.
     */
    inspection?: DumpInspection;
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
        UtilDialogPanel.#current =
            new UtilDialogPanel(extensionUri, spec, host);
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
                if ((this.host.initialPath ?? "") !== "") {
                    await this.#inspect(this.host.initialPath!);
                }
                break;
            }

            case "browse": {
                const path = await this.#browse(message.current,
                    message.zip === true);
                if (path !== undefined) {
                    this.post({ type: "browsed", path });
                    await this.#inspect(path);
                }
                break;
            }

            case "inspect": {
                await this.#inspect(message.path.trim());
                break;
            }

            case "inspectSchema": {
                this.#postRead(
                    await this.host.inspection?.readSchema(message.schema));
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
                    let options = built.options;
                    if (this.host.inspection !== undefined) {
                        const load = await this.host.inspection.loadOptions(
                            built.paths[0], message.excluded ?? []);
                        if ("problem" in load) {
                            this.post({ type: "startError", ...load.problem });

                            return false;
                        }
                        options = { ...options, ...load.options };
                    }
                    await this.host.start(options, built.paths,
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
     * Has a load's dump read, and tells the dialog what it holds.
     *
     * @param path The dump's folder or zip.
     */
    async #inspect(path: string): Promise<void> {
        this.#postRead(await this.host.inspection?.read(path));
    }

    /** Tells the dialog a read, unless a newer one replaced it. */
    #postRead(read: IUtilInspectedMessage | undefined): void {
        if (read !== undefined) {
            this.post(read);
        }
    }

    /**
     * @param current What the path field holds, to start the picker at.
     * @param zip Whether a dump goes to one file.
     *
     * @returns The path picked, or undefined where none was.
     */
    async #browse(current: string, zip: boolean): Promise<string | undefined> {
        const browse = this.spec.path?.browse;
        const first = current.split(",")[0].trim();
        const title = this.spec.path?.label;

        if (browse === "dump") {
            return pickDump(title ?? this.spec.title, first);
        }

        if (browse === "folder" && !zip) {
            return pickFolder(title ?? this.spec.title,
                withZipSuffix(first, false));
        }

        const start = first === "" ? undefined : vscode.Uri.file(first);
        // A file to write: an export's, or a dump's zip.
        if (browse === "saveFile" || browse === "folder") {
            const picked = await vscode.window.showSaveDialog({
                title: zip ? this.spec.path?.zip?.label ?? title : title,
                ...(zip ? { filters: { "MariaDB Dump": ["zip"] } } : {}),
                ...(start === undefined ? {} : { defaultUri: start }),
            });

            return picked === undefined ? undefined
                : zip ? withZipSuffix(picked.fsPath, true) : picked.fsPath;
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

/** The quick pick's items, where one picker cannot take both. */
export const PICK_ZIP = "ZIP File...";
export const PICK_FOLDER = "Dump Folder...";

/**
 * Picks a dump: its `.mariadb.dump.zip` or its folder. One picker takes
 * both on macOS; on Windows and Linux VS Code's open dialog picks either
 * files or folders, so a quick pick asks which first.
 *
 * @param title The pickers' title.
 * @param current The path to start at.
 * @param platform Where this runs.
 *
 * @returns The path picked, or undefined where none was.
 */
export const pickDump = async (
    title: string,
    current = "",
    platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> => {
    let files = true;
    let folders = true;
    if (platform !== "darwin") {
        const which = await vscode.window.showQuickPick([
            { label: PICK_ZIP, description: `A dump in one ${ZIP_SUFFIX} file` },
            { label: PICK_FOLDER, description: "A dump's folder" },
        ], { title, placeHolder: "Load a dump from a ZIP file or a folder" });
        if (which === undefined) {
            return undefined;
        }
        files = which.label === PICK_ZIP;
        folders = !files;
    }

    const start = current.trim();
    const picked = await vscode.window.showOpenDialog({
        title,
        canSelectFiles: files,
        canSelectFolders: folders,
        canSelectMany: false,
        openLabel: "Select Dump",
        ...(files ? { filters: { "MariaDB Dump": ["zip"] } } : {}),
        ...(start === "" ? {} : { defaultUri: vscode.Uri.file(start) }),
    });

    return picked?.[0]?.fsPath;
};
