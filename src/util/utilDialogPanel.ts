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
import type { IDumpInfo, UtilOptions } from "../mcp/utilApi.js";
import { errorText } from "../text.js";
import {
    dumpProblem,
    loadFilters,
    schemasToComplete,
    selectionProblem,
    withFullSchema,
    withZipSuffix,
    ZIP_SUFFIX,
} from "./dumpSelection.js";
import {
    buildUtilOptions,
    initialUtilValues,
    type IUtilOperationSpec,
    type IUtilProblem,
    type UtilValues,
} from "./utilFields.js";
import type { UtilHostMessage, UtilWebviewMessage } from "./utilProtocol.js";

/** What the dialog asks of the extension. */
export interface IUtilDialogHost {
    /** The path the dialog starts with. */
    initialPath?: string;
    /** Values the dialog starts with in place of the defaults. */
    initialValues?: UtilValues;
    /** The connections a copy can go to. */
    targets?: string[];
    /**
     * Starts the work. Resolves once it runs, after which the dialog
     * closes; a rejection is shown in the dialog.
     */
    start(options: UtilOptions, paths: string[], target?: string,
        values?: UtilValues): Promise<void>;
    /**
     * Reads what a dump holds, for a load's dialog (`util.inspect_dump`).
     *
     * @param url The dump's folder or zip.
     * @param schema Only this schema, with every name of its objects.
     */
    inspect?(url: string, schema?: string): Promise<IDumpInfo>;
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

    /** A load's dump, as last read, and the path it was read from. */
    #dump: { path: string; info?: IDumpInfo; error?: string } | undefined;
    /** Counts the reads, so that only the newest one's answer is kept. */
    #inspections = 0;

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
                    values: {
                        ...initialUtilValues(this.spec,
                            this.host.initialPath ?? ""),
                        ...this.host.initialValues,
                    },
                    targets: (this.host.targets ?? []).map((uri) => {
                        return { uri, label: connectionLabel(uri) };
                    }),
                });
                if (this.spec.inspects === true
                    && (this.host.initialPath ?? "") !== "") {
                    await this.#inspect(this.host.initialPath!);
                }
                break;
            }

            case "browse": {
                const path = await this.#browse(message.current,
                    message.zip === true);
                if (path !== undefined) {
                    this.post({ type: "browsed", path });
                    if (this.spec.inspects === true) {
                        await this.#inspect(path);
                    }
                }
                break;
            }

            case "inspect": {
                if (this.spec.inspects === true) {
                    await this.#inspect(message.path.trim());
                }
                break;
            }

            case "inspectSchema": {
                await this.#inspectSchema(message.schema);
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
                    if (this.spec.inspects === true) {
                        const load = await this.#loadOptions(built.paths[0],
                            message.excluded ?? []);
                        if ("problem" in load) {
                            this.post({ type: "startError", ...load.problem });

                            return false;
                        }
                        options = { ...options, ...load.options };
                        // The tool refuses it for a folder.
                        if (!load.zip) {
                            delete options.extraction_budget_mb;
                        }
                    }
                    await this.host.start(options, built.paths,
                        built.target, message.values);

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
     * Reads what the dump at a path holds and tells the dialog.
     *
     * @param path The dump's folder or zip.
     */
    async #inspect(path: string): Promise<void> {
        const inspection = ++this.#inspections;
        if (path === "" || this.host.inspect === undefined) {
            this.#dump = undefined;
            this.post({ type: "inspected", path });

            return;
        }

        let dump: { path: string; info?: IDumpInfo; error?: string };
        try {
            dump = { path, info: await this.host.inspect(path) };
        } catch (error) {
            dump = { path, error: errorText(error) };
        }
        // A path picked meanwhile has the say.
        if (inspection === this.#inspections) {
            this.#dump = dump;
            this.post({ type: "inspected", ...dump });
        }
    }

    /**
     * Reads every name of one of the dump's schemas, where it listed only
     * some, and tells the dialog the dump again.
     *
     * @param schema The schema.
     */
    async #inspectSchema(schema: string): Promise<void> {
        const dump = this.#dump;
        if (dump?.info === undefined || this.host.inspect === undefined) {
            return;
        }
        try {
            const info = withFullSchema(dump.info,
                await this.host.inspect(dump.path, schema));
            if (this.#dump === dump) {
                this.#dump = { path: dump.path, info };
                this.post({ type: "inspected", path: dump.path, info });
            }
        } catch (error) {
            this.host.log(`Could not read every name of ${schema} in `
                + `${dump.path}: ${errorText(error)}`);
        }
    }

    /**
     * The options a load gets from what the dump holds and what is
     * unticked, where it can be loaded where the dialog was opened.
     *
     * @param path The dump's folder or zip.
     * @param excluded The boxes unticked.
     *
     * @returns The options, or why it cannot be loaded.
     */
    async #loadOptions(path: string, excluded: string[]): Promise<{
        options: UtilOptions;
        /** Whether the dump is a zip, not a folder. */
        zip: boolean;
    } | { problem: IUtilProblem }> {
        if (this.#dump?.path !== path) {
            await this.#inspect(path);
        }
        const dump = this.#dump;
        if (dump?.info === undefined) {
            return { problem: { field: "path",
                message: dump?.error ?? "This is not a dump." } };
        }
        const problem = dumpProblem(dump.info, this.spec.intoSchema)
            ?? selectionProblem(dump.info, excluded, this.spec.intoSchema);
        if (problem !== undefined) {
            return { problem: { field: "path", message: problem } };
        }

        // A whole kind of objects unticked needs every name of it.
        let info = dump.info;
        for (const schema of schemasToComplete(info, excluded)) {
            info = withFullSchema(info,
                await this.host.inspect!(path, schema));
        }

        return {
            options: loadFilters(info, excluded, this.spec.intoSchema),
            zip: info.format === "zip",
        };
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

        if (browse === "folder" && zip) {
            const picked = await vscode.window.showSaveDialog({
                title: this.spec.path?.zip?.label ?? title,
                filters: { "MariaDB Dump": ["zip"] },
                ...(first === "" ? {} : { defaultUri: vscode.Uri.file(first) }),
            });

            return picked === undefined ? undefined
                : withZipSuffix(picked.fsPath, true);
        }

        if (browse === "folder") {
            return pickFolder(title ?? this.spec.title,
                withZipSuffix(first, false));
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
