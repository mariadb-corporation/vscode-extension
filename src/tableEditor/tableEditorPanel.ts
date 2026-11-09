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

/**
 * The table editor's panel: one per table, in the editor group below the
 * one the user worked in (a vertical split of the main editor), where the
 * table editors open since stay together.
 */

import * as vscode from "vscode";

import type { IMsmSchemaEdit } from "../mcp/msmApi.js";
import { errorText } from "../text.js";
import { buildWebviewHtml, webviewOptions } from "../webview/html.js";
import { belowActive, type IEditorLayout } from "./editorLayout.js";
import {
    tableEditorKey,
    type TableEditorHostMessage,
    type TableEditorTarget,
    type TableEditorWebviewMessage,
} from "./tableEditorProtocol.js";
import { PartlyAppliedError, type ITableSource } from "./tableSources.js";

/** What a table editor tells the extension. */
export interface ITableEditorHost {
    extensionUri: vscode.Uri;
    log(message: string): void;
    /** A Save changed the table: trees, details and diagrams read again. */
    /**
     * A Save changed the table; `renamedFrom` is what it was called where
     * the Save renamed it.
     */
    changed(target: TableEditorTarget, renamedFrom?: string): void;
    /** View Data: a live table's rows; not offered for a project's. */
    viewData?(target: TableEditorTarget): void;
}

/** One table's editor. */
export class TableEditorPanel {
    static readonly #open = new Map<string, TableEditorPanel>();

    readonly #panel: vscode.WebviewPanel;
    #target: TableEditorTarget;
    #disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        target: TableEditorTarget,
        private readonly source: ITableSource,
        private readonly host: ITableEditorHost,
    ) {
        this.#panel = panel;
        this.#target = target;
        panel.webview.html = buildWebviewHtml(panel.webview,
            host.extensionUri, "tableEditor", `Edit Table ${target.table}`);
        panel.webview.onDidReceiveMessage((message: TableEditorWebviewMessage) => {
            void this.#onMessage(message);
        }, undefined, this.#disposables);
        panel.onDidDispose(() => { this.#dispose(); }, undefined,
            this.#disposables);
    }

    /**
     * Opens a table's editor, or shows the one open.
     *
     * @param target The table.
     * @param source Where it is read and changed.
     * @param host What the editor tells the extension.
     */
    public static async show(
        target: TableEditorTarget,
        source: () => ITableSource,
        host: ITableEditorHost,
    ): Promise<void> {
        const open = TableEditorPanel.#open.get(tableEditorKey(target));
        if (open !== undefined) {
            open.#panel.reveal(open.#panel.viewColumn, false);

            return;
        }
        const panel = vscode.window.createWebviewPanel("mariadb.tableEditor",
            TableEditorPanel.#title(target), await TableEditorPanel.#column(),
            { ...webviewOptions(host.extensionUri),
                retainContextWhenHidden: true });
        panel.iconPath = {
            light: vscode.Uri.joinPath(host.extensionUri, "images", "light",
                "schemaTable.svg"),
            dark: vscode.Uri.joinPath(host.extensionUri, "images", "dark",
                "schemaTable.svg"),
        };
        TableEditorPanel.#open.set(tableEditorKey(target),
            new TableEditorPanel(panel, target, source(), host));
    }

    /**
     * @returns Where a new editor goes: beside the table editors open,
     *          else in the group below the active one, made only where the
     *          active one is not split top and bottom already (or the
     *          editor area is empty), so splits do not nest.
     */
    static async #column(): Promise<vscode.ViewColumn> {
        for (const editor of TableEditorPanel.#open.values()) {
            if (editor.#panel.viewColumn !== undefined) {
                return editor.#panel.viewColumn;
            }
        }
        const active = vscode.window.tabGroups.activeTabGroup;
        if (active.tabs.length === 0) {
            return vscode.ViewColumn.Active;
        }
        const layout = await vscode.commands.executeCommand<
            IEditorLayout | undefined>("vscode.getEditorLayout");
        const below = layout === undefined
            ? "split" : belowActive(layout, active.viewColumn);
        if (below === "split") {
            await vscode.commands.executeCommand(
                "workbench.action.newGroupBelow");

            return vscode.ViewColumn.Active;
        }

        return below === "active" ? vscode.ViewColumn.Active : below.column;
    }

    /**
     * @param target A table.
     *
     * @returns Its editor's tab title.
     */
    static #title(target: TableEditorTarget): string {
        return `${target.table} (${target.schema})`;
    }

    #post(message: TableEditorHostMessage): void {
        void this.#panel.webview.postMessage(message);
    }

    async #load(): Promise<void> {
        try {
            this.#post({ type: "load", data: await this.source.read() });
        } catch (error) {
            this.host.log(`Could not read the table ${this.#target.table}: `
                + errorText(error));
            this.#post({ type: "loadFailed", message: errorText(error) });
        }
    }

    async #onMessage(message: TableEditorWebviewMessage): Promise<void> {
        switch (message.type) {
            case "ready":
            case "refresh": {
                await this.#load();
                break;
            }

            case "preview": {
                try {
                    const preview = await this.source.preview(message.edits);
                    this.#post({ type: "preview", request: message.request,
                        ...preview });
                } catch (error) {
                    this.#post({ type: "preview", request: message.request,
                        statements: [], notes: [], error: errorText(error) });
                }
                break;
            }

            case "apply": {
                await this.#apply(message.edits);
                break;
            }

            case "viewData": {
                this.host.viewData?.(this.#target);
                break;
            }

            default:
        }
    }

    async #apply(edits: IMsmSchemaEdit[]): Promise<void> {
        this.#post({ type: "busy", busy: true });
        try {
            const applied = await this.source.apply(edits);
            this.host.log(`Changed the table ${this.#target.schema}.`
                + `${this.#target.table}: ${edits.length} edit(s).`);
            const before = this.#target.table;
            this.#renamed();
            this.host.changed(this.#target,
                before === this.#target.table ? undefined : before);
            await this.#load();
            this.#post({ type: "applied", notes: applied.notes });
        } catch (error) {
            const done = error instanceof PartlyAppliedError ? error.done : [];
            this.host.log(`Could not change the table ${this.#target.table}: `
                + errorText(error));
            if (done.length > 0) {
                // What ran stays run: the table is read again as it is.
                this.host.changed(this.#target);
                await this.#load();
            }
            this.#post({ type: "applyFailed", message: errorText(error), done });
        } finally {
            this.#post({ type: "busy", busy: false });
        }
    }

    /** Follows a rename the Save made. */
    #renamed(): void {
        if (this.source.table === this.#target.table) {
            return;
        }
        TableEditorPanel.#open.delete(tableEditorKey(this.#target));
        this.#target = { ...this.#target, table: this.source.table };
        TableEditorPanel.#open.set(tableEditorKey(this.#target), this);
        this.#panel.title = TableEditorPanel.#title(this.#target);
    }

    #dispose(): void {
        if (TableEditorPanel.#open.get(tableEditorKey(this.#target)) === this) {
            TableEditorPanel.#open.delete(tableEditorKey(this.#target));
        }
        for (const disposable of this.#disposables) {
            disposable.dispose();
        }
        this.#disposables = [];
    }
}
